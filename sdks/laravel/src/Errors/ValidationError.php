<?php

declare(strict_types=1);

namespace Paycrest\SDK\Errors;

final class ValidationError extends PaycrestApiError
{
    /** @var list<FieldError> */
    public readonly array $fieldErrors;

    public function __construct(string $message, mixed $details = null)
    {
        parent::__construct($message, 400, $details);
        $this->fieldErrors = self::parseFieldErrors($details);
    }

    /**
     * @return list<FieldError>
     */
    private static function parseFieldErrors(mixed $details): array
    {
        if (!is_array($details)) {
            return [];
        }
        $out = [];
        foreach ($details as $row) {
            if (!is_array($row)) {
                continue;
            }
            $field = $row['field'] ?? null;
            $message = $row['message'] ?? null;
            if (is_string($field) && is_string($message)) {
                $out[] = new FieldError($field, $message);
            }
        }
        return $out;
    }
}
