<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class NetworkError extends PaycrestApiError
{
    public function __construct(string $message, mixed $cause = null)
    {
        parent::__construct($message, 0, $cause);
    }
}
