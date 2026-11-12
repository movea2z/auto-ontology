// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Report whether the instance-wide "Visualize SQL Results" setting is on.
//
// The flag lives under Settings > Agent Settings, stored in the
// `configurations` key/value table. The chat proxy route resolves the value per
// request, so a client cannot override it.
//
// The container reads the flag the way this route used to, so the answer is
// unchanged.
export const GET = withPermission({ visualization: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Turn the instance-wide "Visualize SQL Results" setting on or off (admin-only).
//
// Chat resolves the value per request, so the change takes effect on the next
// question without a client reload. It gates chart *generation* only — the
// result table still renders when it is off.
//
// The upsert now happens in the container, which owns the flag, so the request
// forwards verbatim.
export const PUT = withPermission({ visualization: ['manage'] })(async (req) =>
	proxyToBackend(req),
);
