use thiserror::Error;

/// Classification of aggregator-level errors.
///
/// Populated on `PaycrestError::Api` so callers can branch with
/// `matches!` instead of inspecting error messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Unspecified,
    Validation,
    Authentication,
    NotFound,
    RateLimit,
    ProviderUnavailable,
    OrderRejected,
    RateQuoteUnavailable,
    Network,
}

#[derive(Debug, Error)]
pub enum PaycrestError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("api error ({status_code}): {message}")]
    Api {
        status_code: u16,
        message: String,
        details: Option<serde_json::Value>,
        #[doc(hidden)]
        kind: ErrorKind,
        /// `Retry-After` header value in seconds when the server sent one.
        retry_after_seconds: Option<f64>,
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

/// One field-level error as returned by the aggregator's 400 responses.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

impl PaycrestError {
    /// Returns structured field errors when this is a 400 validation
    /// response that carried the aggregator's conventional
    /// `[{field, message}, ...]` payload. Empty for any other shape.
    pub fn field_errors(&self) -> Vec<FieldError> {
        let details = match self {
            PaycrestError::Api { details, kind: ErrorKind::Validation, .. } => details,
            _ => return Vec::new(),
        };
        let Some(details) = details.as_ref() else { return Vec::new(); };
        let Some(array) = details.as_array() else { return Vec::new(); };
        array
            .iter()
            .filter_map(|row| serde_json::from_value::<FieldError>(row.clone()).ok())
            .collect()
    }

    /// Convenience constructor matching the pre-2.1 `Api` shape so
    /// existing call sites don't churn when they don't care about the
    /// typed kind.
    pub fn api(status_code: u16, message: impl Into<String>, details: Option<serde_json::Value>) -> Self {
        Self::Api {
            status_code,
            message: message.into(),
            details,
            kind: classify_kind(status_code),
            retry_after_seconds: None,
        }
    }

    pub fn api_with_kind(
        status_code: u16,
        message: impl Into<String>,
        details: Option<serde_json::Value>,
        kind: ErrorKind,
    ) -> Self {
        Self::Api {
            status_code,
            message: message.into(),
            details,
            kind,
            retry_after_seconds: None,
        }
    }

    /// Returns the typed kind when this is an Api variant, else
    /// `ErrorKind::Unspecified`.
    pub fn kind(&self) -> ErrorKind {
        match self {
            PaycrestError::Api { kind, .. } => *kind,
            PaycrestError::MissingRateQuote => ErrorKind::RateQuoteUnavailable,
            PaycrestError::MissingSenderCredentials | PaycrestError::MissingProviderCredentials => {
                ErrorKind::Validation
            }
            PaycrestError::Http(_) => ErrorKind::Network,
            _ => ErrorKind::Unspecified,
        }
    }
}

pub(crate) fn classify_kind(status_code: u16) -> ErrorKind {
    match status_code {
        400 => ErrorKind::Validation,
        401 | 403 => ErrorKind::Authentication,
        404 => ErrorKind::NotFound,
        429 => ErrorKind::RateLimit,
        503 => ErrorKind::ProviderUnavailable,
        _ => ErrorKind::Unspecified,
    }
}
