<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

use RuntimeException;

/**
 * Base aggregator error. Typed subclasses below let callers branch
 * with ``$e instanceof ValidationError`` etc. instead of inspecting
 * error messages.
 */
class PaycrestApiError extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $statusCode = 0,
        public readonly mixed $details = null,
        public readonly ?float $retryAfterSeconds = null,
    ) {
        parent::__construct($message, $statusCode);
    }
}
