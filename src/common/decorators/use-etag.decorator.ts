import { SetMetadata } from '@nestjs/common';

export const ETAG_KEY = 'useETag';

/**
 * Apply to a GET handler to opt it in to ETag / If-None-Match caching.
 *
 * The ETagInterceptor will:
 *   1. Compute a weak ETag from the serialised response body.
 *   2. Set the `ETag` response header.
 *   3. Return `304 Not Modified` when the client's `If-None-Match` header
 *      matches, saving bandwidth on repeat polls.
 *
 * @example
 * ```ts
 * @Get(':id')
 * @UseETag()
 * findOne(@Param('id') id: string) { ... }
 * ```
 */
export const UseETag = () => SetMetadata(ETAG_KEY, true);
