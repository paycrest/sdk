<?php

// Contract-focused pseudo-tests for Laravel SDK behavior.
// These are documentation-level test cases until PHPUnit is wired.

// 1) Sender createOfframpOrder without rate should fetch /rates side=sell then /sender/orders.
// 2) Sender createOnrampOrder without rate should fetch /rates side=buy then /sender/orders.
// 3) Sender createOrder should auto-route by source/destination types.
// 4) Separate sender/provider API keys should initialize separate clients in PaycrestClient.
// 5) ProviderClient should map list/get/stats/node-info/market-rate endpoints exactly.
// 6) Sender should throw RuntimeException when side quote is unavailable.
