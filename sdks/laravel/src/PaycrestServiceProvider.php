<?php

namespace Paycrest\SDK;

use Illuminate\Support\ServiceProvider;
use Paycrest\SDK\Client\PaycrestClient;

class PaycrestServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/paycrest.php', 'paycrest');

        $this->app->singleton('paycrest-sdk', function ($app) {
            $config = $app['config']->get('paycrest', []);
            return new PaycrestClient(
                apiKey: (string)($config['api_key'] ?? ''),
                baseUrl: (string)($config['base_url'] ?? 'https://api.paycrest.io/v2'),
                timeout: (int)($config['timeout'] ?? 20),
            );
        });
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__ . '/../config/paycrest.php' => config_path('paycrest.php'),
        ], 'paycrest-config');
    }
}
