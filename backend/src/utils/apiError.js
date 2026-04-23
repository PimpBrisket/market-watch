class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function createApiError(status, code, message, details = null) {
  return new ApiError(status, code, message, details);
}

function normalizeApiError(error, fallbackStatus = 500) {
  if (error instanceof ApiError) {
    return error;
  }

  if (
    error &&
    typeof error === "object" &&
    Number.isInteger(error.status) &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return new ApiError(error.status, error.code, error.message, error.details || null);
  }

  return new ApiError(
    fallbackStatus,
    fallbackStatus >= 500 ? "internal_error" : "bad_request",
    error?.message || "Unexpected error.",
    null
  );
}

module.exports = {
  ApiError,
  createApiError,
  normalizeApiError
};
