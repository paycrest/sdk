<?php

declare(strict_types=1);

namespace Paycrest\SDK\Queries;

final class ProviderListOrdersQuery
{
    public function __construct(
        public readonly string $currency,
        public readonly int $page = 1,
        public readonly int $pageSize = 10,
        public readonly ?string $status = null,
        public readonly ?string $ordering = null,
        public readonly ?string $search = null,
        public readonly ?string $export = null,
        public readonly ?string $from = null,
        public readonly ?string $to = null,
    ) {
    }
}
