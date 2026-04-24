<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class OrderRejectedError extends PaycrestApiError
{
    public function __construct(string $message, int $statusCode = 400, mixed $details = null)
    {
        parent::__construct($message, $statusCode, $details);
    }
}
