<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class RateQuoteUnavailableError extends PaycrestApiError
{
    public function __construct(string $message = 'Rate quote unavailable for this pair', mixed $details = null)
    {
        parent::__construct($message, 404, $details);
    }
}
