<?php

declare(strict_types=1);

namespace Paycrest\SDK\Queries;

final class ListOrdersQuery
{
    public function __construct(
        public readonly int $page = 1,
        public readonly int $pageSize = 10,
        public readonly ?string $status = null,
    ) {
    }
}
