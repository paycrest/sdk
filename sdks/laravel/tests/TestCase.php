<?php

namespace Paycrest\SDK\Tests;

use Orchestra\Testbench\TestCase as OrchestraTestCase;
use Paycrest\SDK\PaycrestServiceProvider;

abstract class TestCase extends OrchestraTestCase
{
    protected function getPackageProviders($app): array
    {
        return [PaycrestServiceProvider::class];
    }
}
