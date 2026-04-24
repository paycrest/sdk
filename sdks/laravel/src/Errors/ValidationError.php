<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class ValidationError extends PaycrestApiError
{
    public function __construct(string $message, mixed $details = null)
    {
        parent::__construct($message, 400, $details);
    }
}
