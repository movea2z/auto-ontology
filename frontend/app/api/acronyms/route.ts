// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// List every acronym, newest first.
//
// With `?name=`, the route answers `{ exists }` instead of listing — the create
// form uses it to pre-check the unique constraint before submitting.
//
// The container holds the `frontend` schema tables Prisma read here, so the
// request — query string included — forwards verbatim and the answer comes back
// unchanged.
export const GET = withPermission({ acronym: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Create an acronym: the term plus the expansion the agent should read it as.
//
// `name` must be unique; `description` is optional and defaults to empty.
export const POST = withPermission({ acronym: ['create'] })(async (req) =>
	proxyToBackend(req),
);
