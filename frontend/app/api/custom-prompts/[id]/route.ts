// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

type Ctx = { params: Promise<{ id: string }> };

// Fetch one custom prompt by id; 404 when no prompt has that id.
//
// The id comes from the path, which the container reads directly.
export const GET = withPermission<Ctx>({ prompt: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Update a custom prompt's text. `content` is the only writable field, and a
// body without it leaves the prompt unchanged.
export const PATCH = withPermission<Ctx>({ prompt: ['update'] })(async (req) =>
	proxyToBackend(req),
);

// Delete a custom prompt permanently. Answers 204 with no body.
export const DELETE = withPermission<Ctx>({ prompt: ['delete'] })(async (req) =>
	proxyToBackend(req),
);
