<?php

declare(strict_types=1);

namespace Paycrest\SDK\Queries;

final class WaitForStatusOptions
{
    public function __construct(
        public readonly int $pollMs = 3_000,
        public readonly int $timeoutMs = 5 * 60 * 1000,
    ) {
    }
}
