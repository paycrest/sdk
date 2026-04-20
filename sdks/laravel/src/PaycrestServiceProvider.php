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
                apiKey: isset($config['api_key']) ? (string)$config['api_key'] : null,
                senderApiKey: isset($config['sender_api_key']) ? (string)$config['sender_api_key'] : null,
                providerApiKey: isset($config['provider_api_key']) ? (string)$config['provider_api_key'] : null,
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
