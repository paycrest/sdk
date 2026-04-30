<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

/**
 * One field-level error as returned by the aggregator's 400
 * responses (``data: [{field, message}, ...]``).
 */
final class FieldError
{
    public function __construct(
        public readonly string $field,
        public readonly string $message,
    ) {
    }
}
