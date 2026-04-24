<?php

declare(strict_types=1);

namespace Paycrest\SDK\Gateway;

/**
 * Minimal signer+RPC contract the gateway path needs.
 *
 * Implementations typically wrap web3.php or a JSON-RPC client and
 * handle chain-specific key management. The SDK hands off the ABI
 * arguments (not raw calldata) so adapters can use high-level helpers.
 *
 * All amount-like values are decimal strings to avoid PHP int overflow.
 */
interface GatewayTransactor
{
    public function chainId(): int;

    public function senderAddress(): string;

    /**
     * Returns the ERC-20 allowance granted by $owner to $spender on
     * $token as a decimal string (to preserve precision).
     */
    public function allowance(string $token, string $owner, string $spender): string;

    /**
     * Broadcasts ERC-20 `approve(spender, amount)` on $token. Returns
     * the transaction hash (hex string).
     */
    public function approve(string $token, string $spender, string $amount): string;

    /**
     * Broadcasts `Gateway.createOrder(...)` on $gateway. Returns the
     * transaction hash.
     *
     * @param array{
     *   token:string,
     *   amount:string,
     *   rate:string,
     *   senderFeeRecipient:string,
     *   senderFee:string,
     *   refundAddress:string,
     *   messageHash:string
     * } $args
     */
    public function createOrder(string $gateway, array $args): string;
}
