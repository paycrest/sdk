<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class ErrorClassifier
{
    public static function classifyHttpError(
        int $statusCode,
        string $message,
        mixed $details = null,
        ?float $retryAfterSeconds = null,
    ): PaycrestApiError {
        return match (true) {
            $statusCode === 400 => new ValidationError($message, $details),
            $statusCode === 401 || $statusCode === 403 => new AuthenticationError($message, $details),
            $statusCode === 404 => new NotFoundError($message, $details),
            $statusCode === 429 => new RateLimitError($message, $retryAfterSeconds, $details),
            $statusCode === 503 => new ProviderUnavailableError($message, $statusCode, $details),
            default => new PaycrestApiError($message, $statusCode, $details, $retryAfterSeconds),
        };
    }
}
