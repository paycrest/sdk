<?php

declare(strict_types=1);

namespace Paycrest\SDK\Gateway;

use InvalidArgumentException;

/**
 * Direct-contract off-ramp helper.
 *
 * Lets integrators bypass the aggregator API and call the Paycrest Gateway
 * contract themselves (same pattern noblocks uses). The SDK stays web3-
 * library-agnostic: it returns the contract address, ABI, function name
 * and argument array so callers can feed them into web3.php / ethers-php /
 * any signer they already use.
 */
class Gateway
{
    public const ABI = [
        [
            'type' => 'function',
            'name' => 'createOrder',
            'stateMutability' => 'nonpayable',
            'inputs' => [
                ['name' => '_token', 'type' => 'address'],
                ['name' => '_amount', 'type' => 'uint256'],
                ['name' => '_rate', 'type' => 'uint96'],
                ['name' => '_senderFeeRecipient', 'type' => 'address'],
                ['name' => '_senderFee', 'type' => 'uint256'],
                ['name' => '_refundAddress', 'type' => 'address'],
                ['name' => 'messageHash', 'type' => 'string'],
            ],
            'outputs' => [
                ['name' => 'orderId', 'type' => 'bytes32'],
            ],
        ],
        [
            'type' => 'function',
            'name' => 'getOrderInfo',
            'stateMutability' => 'view',
            'inputs' => [
                ['name' => '_orderId', 'type' => 'bytes32'],
            ],
            'outputs' => [
                [
                    'name' => '',
                    'type' => 'tuple',
                    'components' => [
                        ['name' => 'sender', 'type' => 'address'],
                        ['name' => 'token', 'type' => 'address'],
                        ['name' => 'senderFeeRecipient', 'type' => 'address'],
                        ['name' => 'senderFee', 'type' => 'uint256'],
                        ['name' => 'protocolFee', 'type' => 'uint256'],
                        ['name' => 'isFulfilled', 'type' => 'bool'],
                        ['name' => 'isRefunded', 'type' => 'bool'],
                        ['name' => 'refundAddress', 'type' => 'address'],
                        ['name' => 'currentBPS', 'type' => 'uint96'],
                        ['name' => 'amount', 'type' => 'uint256'],
                    ],
                ],
            ],
        ],
        [
            'type' => 'event',
            'name' => 'OrderCreated',
            'inputs' => [
                ['indexed' => true, 'name' => 'sender', 'type' => 'address'],
                ['indexed' => true, 'name' => 'token', 'type' => 'address'],
                ['indexed' => false, 'name' => 'amount', 'type' => 'uint256'],
                ['indexed' => false, 'name' => 'protocolFee', 'type' => 'uint256'],
                ['indexed' => true, 'name' => 'orderId', 'type' => 'bytes32'],
                ['indexed' => false, 'name' => 'rate', 'type' => 'uint96'],
                ['indexed' => false, 'name' => 'messageHash', 'type' => 'string'],
            ],
        ],
    ];

    /** @var array<string, string> */
    private static array $addresses = [];

    public function __construct(
        public readonly string $address,
        public readonly ?string $network = null,
    ) {
        if ($address === '') {
            throw new InvalidArgumentException('Gateway contract address is required');
        }
    }

    public static function register(string $network, string $address): void
    {
        self::$addresses[$network] = $address;
    }

    public static function addressFor(string $network): ?string
    {
        return self::$addresses[$network] ?? null;
    }

    public static function forNetwork(string $network, ?string $addressOverride = null): self
    {
        $address = $addressOverride ?: (self::$addresses[$network] ?? null);
        if ($address === null || $address === '') {
            throw new InvalidArgumentException(
                "No Gateway address registered for network \"{$network}\". Pass an address explicitly or call Gateway::register()."
            );
        }
        return new self($address, $network);
    }

    /**
     * @param array{
     *   token:string,
     *   amount:string,
     *   rate:string,
     *   senderFeeRecipient:string,
     *   senderFee:string,
     *   refundAddress:string,
     *   messageHash:string
     * } $params
     * @return array{to:string,abi:array,functionName:string,args:array,value:string}
     */
    public function buildCreateOrderCall(array $params): array
    {
        $required = [
            'token',
            'amount',
            'rate',
            'senderFeeRecipient',
            'senderFee',
            'refundAddress',
            'messageHash',
        ];
        foreach ($required as $key) {
            if (!array_key_exists($key, $params)) {
                throw new InvalidArgumentException("Missing required Gateway createOrder parameter: {$key}");
            }
        }

        return [
            'to' => $this->address,
            'abi' => self::ABI,
            'functionName' => 'createOrder',
            'args' => [
                (string) $params['token'],
                (string) $params['amount'],
                (string) $params['rate'],
                (string) $params['senderFeeRecipient'],
                (string) $params['senderFee'],
                (string) $params['refundAddress'],
                (string) $params['messageHash'],
            ],
            'value' => '0',
        ];
    }

    /**
     * @return array{to:string,abi:array,functionName:string,args:array,value:string}
     */
    public function buildGetOrderInfoCall(string $orderId): array
    {
        return [
            'to' => $this->address,
            'abi' => self::ABI,
            'functionName' => 'getOrderInfo',
            'args' => [$orderId],
            'value' => '0',
        ];
    }
}
