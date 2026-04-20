<?php

return [
    'api_key' => env('PAYCREST_API_KEY'),
    'sender_api_key' => env('PAYCREST_SENDER_API_KEY'),
    'provider_api_key' => env('PAYCREST_PROVIDER_API_KEY'),
    'base_url' => env('PAYCREST_BASE_URL', 'https://api.paycrest.io/v2'),
    'timeout' => env('PAYCREST_TIMEOUT', 20),
    'webhook_secret' => env('PAYCREST_WEBHOOK_SECRET'),
];
