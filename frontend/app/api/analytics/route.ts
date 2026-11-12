// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Analytics always cover a fixed trailing window; not configurable per-request.
//
// The container reads the last 30 days and joins the User to resolve the
// display name, so the request — query string (skip/limit) included — forwards
// verbatim and the paginated answer comes back unchanged.
export const GET = withPermission({ analytics: ['read'] })(async (req) =>
	proxyToBackend(req),
);
