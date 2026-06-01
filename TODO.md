# TODO - Multi-currency support (ISO 4217 + supported allowlist)

- [x] Step 1: Add currency config service reading `SUPPORTED_CURRENCIES` (comma-separated ISO codes)

- [x] Step 2: Add `IsISO4217CurrencyCode` custom validator that validates:

  - ISO 4217 code format (and correctness via internal allowlist)
  - optional allowlist constraint based on env (`SUPPORTED_CURRENCIES`)
- [x] Step 3: Update `CreatePaymentDto` to use the new validator for `currency`

- [ ] Step 4: Ensure unsupported/invalid currencies return HTTP **422** with descriptive error message

- [ ] Step 5: Add `GET /v1/currencies` endpoint that returns the supported currency list from env
- [ ] Step 6: Update Swagger decorators/examples for the new endpoint and DTO
- [ ] Step 7: Update/extend e2e tests (`test/payments.e2e-spec.ts`) for:
  - invalid ISO currency -> 422
  - valid but unsupported currency -> 422
  - GET /v1/currencies -> returns current env list
- [ ] Step 8: Run e2e tests locally and fix any regressions

