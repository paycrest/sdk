<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class ProviderUnavailableError extends PaycrestApiError
{
    public function __construct(
        string $message = 'No provider available for this order',
        int $statusCode = 503,
        mixed $details = null,
    ) {
        parent::__construct($message, $statusCode, $details);
    }
}
