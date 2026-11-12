// SPDX-FileCopyrightText: Copyright (c) 2024-2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Key/value stored in the `configurations` table. The Python ingestion service
// reads this same key to decide whether to start its semantic scheduler.
const CONFIG_KEY = 'semantic_compilation_enabled';

// Report whether scheduled semantic compilation is enabled instance-wide.
//
// The container reads the flag the way this route used to (see
// auto_ontology/infra/feature_flags.py), so the answer is unchanged.
export const GET = withPermission({ semanticCompilation: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Turn scheduled semantic compilation on or off instance-wide (admin-only).
//
// Enabling also kicks off a compilation run immediately and starts the ingestion
// service's scheduler, so the change takes effect without a restart. That
// trigger is best-effort: the setting is still saved if the service is down, and
// the scheduler picks the flag up on its next boot.
//
// The trigger now happens in the container, which owns both the flag and the
// scheduler, so the request forwards verbatim.
export const PUT = withPermission({ semanticCompilation: ['manage'] })(async (req) =>
	proxyToBackend(req),
);
