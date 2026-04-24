<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class NotFoundError extends PaycrestApiError
{
    public function __construct(string $message = 'Resource not found', mixed $details = null)
    {
        parent::__construct($message, 404, $details);
    }
}
