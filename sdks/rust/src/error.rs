use thiserror::Error;

#[derive(Debug, Error)]
pub enum PaycrestError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("api error ({status_code}): {message}")]
    Api {
        status_code: u16,
        message: String,
        details: Option<serde_json::Value>,
    },

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("provider sdk support is not available yet in v2 monorepo")]
    ProviderUnavailable,
}
