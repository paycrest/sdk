module parity-client

go 1.22

// The parity client lives inside the same monorepo as the SDK module.
// Use a local replace so the test compiles against the in-tree source
// without needing a published tag.
require github.com/paycrest/sdk/sdks/go v0.0.0

replace github.com/paycrest/sdk/sdks/go => ../../../../sdks/go
