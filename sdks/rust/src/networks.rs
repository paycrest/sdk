//! Canonical Paycrest network registry.
//!
//! Mirrors the on-chain Gateway deployments referenced in noblocks
//! (`getGatewayContractAddress`). Network slugs match the aggregator's
//! `identifier` (e.g. `base`, `arbitrum-one`).

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

#[derive(Debug, Clone)]
pub struct NetworkInfo {
    pub slug: &'static str,
    pub chain_id: u64,
    pub display_name: &'static str,
    pub gateway: &'static str,
}

const BUNDLED: &[NetworkInfo] = &[
    NetworkInfo {
        slug: "base",
        chain_id: 8453,
        display_name: "Base",
        gateway: "0x30f6a8457f8e42371e204a9c103f2bd42341dd0f",
    },
    NetworkInfo {
        slug: "arbitrum-one",
        chain_id: 42161,
        display_name: "Arbitrum One",
        gateway: "0xe8bc3b607cfe68f47000e3d200310d49041148fc",
    },
    NetworkInfo {
        slug: "bnb-smart-chain",
        chain_id: 56,
        display_name: "BNB Smart Chain",
        gateway: "0x1fa0ee7f9410f6fa49b7ad5da72cf01647090028",
    },
    NetworkInfo {
        slug: "polygon",
        chain_id: 137,
        display_name: "Polygon",
        gateway: "0xfb411cc6385af50a562afcb441864e9d541cda67",
    },
    NetworkInfo {
        slug: "scroll",
        chain_id: 534352,
        display_name: "Scroll",
        gateway: "0x663c5bfe7d44ba946c2dd4b2d1cf9580319f9338",
    },
    NetworkInfo {
        slug: "optimism",
        chain_id: 10,
        display_name: "Optimism",
        gateway: "0xd293fcd3dbc025603911853d893a4724cf9f70a0",
    },
    NetworkInfo {
        slug: "celo",
        chain_id: 42220,
        display_name: "Celo",
        gateway: "0xf418217e3f81092ef44b81c5c8336e6a6fdb0e4b",
    },
    NetworkInfo {
        slug: "lisk",
        chain_id: 1135,
        display_name: "Lisk",
        gateway: "0xff0E00E0110C1FBb5315D276243497b66D3a4d8a",
    },
    NetworkInfo {
        slug: "ethereum",
        chain_id: 1,
        display_name: "Ethereum",
        gateway: "0x8d2c0d398832b814e3814802ff2dc8b8ef4381e5",
    },
];

fn networks() -> &'static RwLock<HashMap<String, NetworkInfo>> {
    static INSTANCE: OnceLock<RwLock<HashMap<String, NetworkInfo>>> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let mut map = HashMap::new();
        for n in BUNDLED.iter() {
            map.insert(n.slug.to_string(), n.clone());
        }
        RwLock::new(map)
    })
}

pub fn get_network(slug: &str) -> Result<NetworkInfo, String> {
    let guard = networks().read().map_err(|_| "registry poisoned".to_string())?;
    guard
        .get(&slug.to_lowercase())
        .cloned()
        .ok_or_else(|| format!("unsupported network \"{slug}\""))
}

pub fn register_network(info: NetworkInfo) {
    if let Ok(mut guard) = networks().write() {
        guard.insert(info.slug.to_lowercase(), info);
    }
}
