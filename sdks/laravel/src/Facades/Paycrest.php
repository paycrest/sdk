<?php

namespace Paycrest\SDK\Facades;

use Illuminate\Support\Facades\Facade;

class Paycrest extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'paycrest-sdk';
    }
}
