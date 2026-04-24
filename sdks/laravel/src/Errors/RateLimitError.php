<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class RateLimitError extends PaycrestApiError
{
    public function __construct(
        string $message = 'Rate limit exceeded',
        ?float $retryAfterSeconds = null,
        mixed $details = null,
    ) {
        parent::__construct($message, 429, $details, $retryAfterSeconds);
    }
}
