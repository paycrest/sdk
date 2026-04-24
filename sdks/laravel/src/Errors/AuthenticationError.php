<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class AuthenticationError extends PaycrestApiError
{
    public function __construct(string $message = 'Authentication failed — check API-Key', mixed $details = null)
    {
        parent::__construct($message, 401, $details);
    }
}
