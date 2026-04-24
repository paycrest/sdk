//! Direct-contract off-ramp helpers.
//!
//! Integrators who want to bypass the aggregator API can call the Paycrest
//! Gateway contract directly (same pattern used by noblocks). This module is
//! web3-library-agnostic: it returns the contract address, ABI, function
//! name and argument list so callers can feed them to ethers-rs, alloy, or
//! any other signer they already use.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use serde_json::{json, Value};

use crate::error::PaycrestError;

pub fn gateway_abi() -> Value {
    json!([
        {
            "type": "function",
            "name": "createOrder",
            "stateMutability": "nonpayable",
            "inputs": [
                {"name": "_token", "type": "address"},
                {"name": "_amount", "type": "uint256"},
                {"name": "_rate", "type": "uint96"},
                {"name": "_senderFeeRecipient", "type": "address"},
                {"name": "_senderFee", "type": "uint256"},
                {"name": "_refundAddress", "type": "address"},
                {"name": "messageHash", "type": "string"}
            ],
            "outputs": [{"name": "orderId", "type": "bytes32"}]
        },
        {
            "type": "function",
            "name": "getOrderInfo",
            "stateMutability": "view",
            "inputs": [{"name": "_orderId", "type": "bytes32"}],
            "outputs": [{
                "name": "",
                "type": "tuple",
                "components": [
                    {"name": "sender", "type": "address"},
                    {"name": "token", "type": "address"},
                    {"name": "senderFeeRecipient", "type": "address"},
                    {"name": "senderFee", "type": "uint256"},
                    {"name": "protocolFee", "type": "uint256"},
                    {"name": "isFulfilled", "type": "bool"},
                    {"name": "isRefunded", "type": "bool"},
                    {"name": "refundAddress", "type": "address"},
                    {"name": "currentBPS", "type": "uint96"},
                    {"name": "amount", "type": "uint256"}
                ]
            }]
        },
        {
            "type": "event",
            "name": "OrderCreated",
            "inputs": [
                {"indexed": true, "name": "sender", "type": "address"},
                {"indexed": true, "name": "token", "type": "address"},
                {"indexed": false, "name": "amount", "type": "uint256"},
                {"indexed": false, "name": "protocolFee", "type": "uint256"},
                {"indexed": true, "name": "orderId", "type": "bytes32"},
                {"indexed": false, "name": "rate", "type": "uint96"},
                {"indexed": false, "name": "messageHash", "type": "string"}
            ]
        }
    ])
}

fn gateway_addresses() -> &'static RwLock<HashMap<String, String>> {
    static INSTANCE: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    INSTANCE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn register_gateway_address(network: impl Into<String>, address: impl Into<String>) {
    gateway_addresses()
        .write()
        .expect("gateway address registry poisoned")
        .insert(network.into(), address.into());
}

pub fn gateway_address_for(network: &str) -> Option<String> {
    gateway_addresses()
        .read()
        .expect("gateway address registry poisoned")
        .get(network)
        .cloned()
}

#[derive(Debug, Clone)]
pub struct GatewayCreateOrderParams {
    pub token: String,
    pub amount: String,
    pub rate: String,
    pub sender_fee_recipient: String,
    pub sender_fee: String,
    pub refund_address: String,
    pub message_hash: String,
}

#[derive(Debug, Clone)]
pub struct GatewayTxRequest {
    pub to: String,
    pub abi: Value,
    pub function_name: String,
    pub args: Vec<Value>,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct Gateway {
    pub address: String,
    pub network: Option<String>,
}

impl Gateway {
    pub fn new(address: impl Into<String>, network: Option<String>) -> Result<Self, PaycrestError> {
        let address = address.into();
        if address.is_empty() {
            return Err(PaycrestError::Api {
                status_code: 400,
                message: "gateway contract address is required".to_string(),
                details: None,
            });
        }
        Ok(Self { address, network })
    }

    pub fn for_network(
        network: &str,
        address_override: Option<&str>,
    ) -> Result<Self, PaycrestError> {
        let address = match address_override {
            Some(addr) if !addr.is_empty() => addr.to_string(),
            _ => gateway_address_for(network).ok_or_else(|| PaycrestError::Api {
                status_code: 400,
                message: format!(
                    "no Gateway address registered for network \"{network}\"; pass an address explicitly or call register_gateway_address"
                ),
                details: None,
            })?,
        };
        Self::new(address, Some(network.to_string()))
    }

    pub fn build_create_order_call(&self, params: &GatewayCreateOrderParams) -> GatewayTxRequest {
        GatewayTxRequest {
            to: self.address.clone(),
            abi: gateway_abi(),
            function_name: "createOrder".to_string(),
            args: vec![
                Value::String(params.token.clone()),
                Value::String(params.amount.clone()),
                Value::String(params.rate.clone()),
                Value::String(params.sender_fee_recipient.clone()),
                Value::String(params.sender_fee.clone()),
                Value::String(params.refund_address.clone()),
                Value::String(params.message_hash.clone()),
            ],
            value: "0".to_string(),
        }
    }

    pub fn build_get_order_info_call(&self, order_id: &str) -> GatewayTxRequest {
        GatewayTxRequest {
            to: self.address.clone(),
            abi: gateway_abi(),
            function_name: "getOrderInfo".to_string(),
            args: vec![Value::String(order_id.to_string())],
            value: "0".to_string(),
        }
    }
}
