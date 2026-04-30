<?php

declare(strict_types=1);

namespace Paycrest\SDK\Gateway;

use InvalidArgumentException;
use Paycrest\SDK\Client\HttpClient;
use Paycrest\SDK\Networks\Networks;
use RuntimeException;

final class GatewayClient
{
    /** @var array<string, array<int, array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}>> */
    private array $tokensCache = [];

    private ?string $publicKeyCached = null;

    public function __construct(
        private readonly HttpClient $publicHttp,
        private readonly GatewayTransactor $transactor,
        private readonly ?string $aggregatorPublicKeyOverride = null,
    ) {
    }

    /**
     * @param array{
     *   amount:string,
     *   rate?:string,
     *   senderFee?:string,
     *   senderFeeRecipient?:string,
     *   source:array{type:string,currency:string,network:string,refundAddress?:string},
     *   destination:array{
     *     type:string,
     *     currency:string,
     *     providerId?:string,
     *     recipient:array{institution:string,accountIdentifier:string,accountName:string,memo:string}
     *   }
     * } $payload
     *
     * @return array{
     *   txHash:string,
     *   approveTxHash:?string,
     *   gatewayAddress:string,
     *   tokenAddress:string,
     *   amount:string,
     *   rate:string,
     *   messageHash:string,
     *   refundAddress:string,
     *   network:string
     * }
     */
    public function createOfframpOrder(array $payload): array
    {
        $network = Networks::get($payload['source']['network']);

        $signerChain = $this->transactor->chainId();
        if ($signerChain !== 0 && $signerChain !== $network['chainId']) {
            throw new RuntimeException(
                "transactor chainId={$signerChain} does not match network \"{$network['slug']}\" (chainId={$network['chainId']})"
            );
        }

        $token = $this->lookupToken($network['slug'], $payload['source']['currency']);

        $rate = $payload['rate'] ?? $this->resolveRate($network['slug'], $payload['source']['currency'], $payload['amount'], $payload['destination']['currency']);

        $recipient = Encryption::buildRecipientPayload([
            'institution' => $payload['destination']['recipient']['institution'],
            'accountIdentifier' => $payload['destination']['recipient']['accountIdentifier'],
            'accountName' => $payload['destination']['recipient']['accountName'],
            'memo' => $payload['destination']['recipient']['memo'],
            'providerId' => $payload['destination']['providerId'] ?? '',
        ]);
        $publicKey = $this->resolvePublicKey();
        $messageHash = Encryption::encryptRecipient($recipient, $publicKey);

        $amountSub = self::toSubunits($payload['amount'], $token['decimals']);
        $feeSub = isset($payload['senderFee']) ? self::toSubunits($payload['senderFee'], $token['decimals']) : '0';
        $rateScaled = self::scaleRate((string)$rate);

        $refundAddress = !empty($payload['source']['refundAddress'])
            ? $payload['source']['refundAddress']
            : $this->transactor->senderAddress();

        $senderFeeRecipient = !empty($payload['senderFeeRecipient'])
            ? $payload['senderFeeRecipient']
            : '0x0000000000000000000000000000000000000000';

        $approveTxHash = null;
        $needed = self::bcAdd($amountSub, $feeSub);
        if (self::bcCmp($needed, '0') > 0) {
            $current = $this->transactor->allowance($token['contractAddress'], $this->transactor->senderAddress(), $network['gateway']);
            if (self::bcCmp($current, $needed) < 0) {
                $approveTxHash = $this->transactor->approve($token['contractAddress'], $network['gateway'], $needed);
            }
        }

        $txHash = $this->transactor->createOrder($network['gateway'], [
            'token' => $token['contractAddress'],
            'amount' => $amountSub,
            'rate' => $rateScaled,
            'senderFeeRecipient' => $senderFeeRecipient,
            'senderFee' => $feeSub,
            'refundAddress' => $refundAddress,
            'messageHash' => $messageHash,
        ]);

        return [
            'txHash' => $txHash,
            'approveTxHash' => $approveTxHash,
            'gatewayAddress' => $network['gateway'],
            'tokenAddress' => $token['contractAddress'],
            'amount' => $amountSub,
            'rate' => (string)$rate,
            'messageHash' => $messageHash,
            'refundAddress' => $refundAddress,
            'network' => $network['slug'],
        ];
    }

    private function resolvePublicKey(): string
    {
        if ($this->aggregatorPublicKeyOverride !== null && $this->aggregatorPublicKeyOverride !== '') {
            return $this->aggregatorPublicKeyOverride;
        }
        if ($this->publicKeyCached !== null) {
            return $this->publicKeyCached;
        }
        $response = $this->publicHttp->request('GET', '/pubkey');
        $pem = $response['data'] ?? '';
        if (!is_string($pem) || $pem === '') {
            throw new RuntimeException('aggregator /pubkey returned no PEM data');
        }
        $this->publicKeyCached = $pem;
        return $pem;
    }

    /**
     * @return array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}
     */
    private function lookupToken(string $networkSlug, string $symbol): array
    {
        // 1) Static registry — zero-RTT for hot tokens.
        $static = TokenRegistry::lookup($networkSlug, $symbol);
        if ($static !== null) {
            return $static;
        }

        // 2) Live fetch (with in-memory cache).
        $slug = strtolower($networkSlug);
        if (!isset($this->tokensCache[$slug])) {
            $response = $this->publicHttp->request('GET', '/tokens', null, ['network' => $slug]);
            $rows = $response['data'] ?? [];
            if (!is_array($rows)) {
                throw new RuntimeException('aggregator /tokens returned invalid payload');
            }
            $this->tokensCache[$slug] = array_values(array_map(static fn ($r) => [
                'symbol' => (string)($r['symbol'] ?? ''),
                'contractAddress' => (string)($r['contractAddress'] ?? ''),
                'decimals' => (int)($r['decimals'] ?? 0),
                'baseCurrency' => (string)($r['baseCurrency'] ?? ''),
                'network' => (string)($r['network'] ?? $slug),
            ], $rows));
        }

        $want = strtoupper($symbol);
        foreach ($this->tokensCache[$slug] as $token) {
            if (strtoupper($token['symbol']) === $want) {
                return $token;
            }
        }
        throw new InvalidArgumentException("Token \"{$symbol}\" is not enabled on network \"{$networkSlug}\".");
    }

    private function resolveRate(string $network, string $token, string $amount, string $fiat): string
    {
        $response = $this->publicHttp->request('GET', "/rates/{$network}/{$token}/{$amount}/{$fiat}", null, ['side' => 'sell']);
        $rate = $response['data']['sell']['rate'] ?? null;
        if (!is_string($rate) || $rate === '') {
            throw new RuntimeException('Aggregator returned no sell-side rate');
        }
        return $rate;
    }

    /**
     * Inject test doubles for the tokens cache (test-only backdoor).
     *
     * @param array<int, array{symbol:string,contractAddress:string,decimals:int,baseCurrency:string,network:string}> $tokens
     */
    public function seedTokens(string $networkSlug, array $tokens): void
    {
        $this->tokensCache[strtolower($networkSlug)] = $tokens;
    }

    public static function toSubunits(string $amount, int $decimals): string
    {
        $trimmed = trim($amount);
        if (!preg_match('/^\d+(\.\d+)?$/', $trimmed)) {
            throw new InvalidArgumentException("Invalid amount \"{$amount}\"");
        }
        $parts = explode('.', $trimmed, 2);
        $whole = $parts[0];
        $fraction = $parts[1] ?? '';
        if (strlen($fraction) > $decimals) {
            throw new InvalidArgumentException("Amount \"{$amount}\" has more fractional digits than token decimals ({$decimals})");
        }
        $fraction = str_pad($fraction, $decimals, '0', STR_PAD_RIGHT);
        return ltrim($whole . $fraction, '0') ?: '0';
    }

    public static function scaleRate(string $rate): string
    {
        $trimmed = trim($rate);
        if (!preg_match('/^\d+(\.\d+)?$/', $trimmed)) {
            throw new InvalidArgumentException("Invalid rate \"{$rate}\"");
        }
        $parts = explode('.', $trimmed, 2);
        $whole = $parts[0];
        $fraction = $parts[1] ?? '';
        if (strlen($fraction) <= 2) {
            $fraction = str_pad($fraction, 2, '0', STR_PAD_RIGHT);
            return ltrim($whole . $fraction, '0') ?: '0';
        }
        $shifted = ltrim($whole . substr($fraction, 0, 2), '0') ?: '0';
        $roundDigit = (int)$fraction[2];
        if ($roundDigit >= 5) {
            $shifted = self::bcAdd($shifted, '1');
        }
        return $shifted;
    }

    private static function bcAdd(string $a, string $b): string
    {
        return function_exists('bcadd') ? bcadd($a, $b, 0) : (string)((int)$a + (int)$b);
    }

    private static function bcCmp(string $a, string $b): int
    {
        if (function_exists('bccomp')) {
            return bccomp($a, $b, 0);
        }
        return (int)$a <=> (int)$b;
    }
}
