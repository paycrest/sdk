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

    #[error("sender credentials are required")]
    MissingSenderCredentials,

    #[error("provider credentials are required")]
    MissingProviderCredentials,

    #[error("unable to resolve rate for requested order")]
    MissingRateQuote,
}
