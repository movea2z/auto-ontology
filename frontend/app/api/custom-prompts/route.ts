// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// List every custom prompt: the instance-wide prompt overrides the agent uses.
export const GET = withPermission({ prompt: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Create a custom prompt from `content`, which defaults to empty when omitted.
export const POST = withPermission({ prompt: ['create'] })(async (req) =>
	proxyToBackend(req),
);
