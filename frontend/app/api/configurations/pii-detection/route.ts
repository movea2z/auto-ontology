// SPDX-FileCopyrightText: Copyright (c) 2026, NVIDIA CORPORATION & AFFILIATES.
// All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { withPermission } from '@/auth/with-auth';
import { proxyToBackend } from '@/auth/proxy-backend';

// Key/value stored in the `configurations` table. The Python ingestion service
// reads this same key (see auto_ontology/infra/feature_flags.py) once per ingest
// to decide whether to classify catalog columns and attach the shared PII tag.
//
// The flag is opt-IN: an instance that has never touched the toggle does not
// classify.
const CONFIG_KEY = 'pii_detection_enabled';

// Report whether ingest classifies catalog columns as PII.
//
// The container reads the flag the way this route used to (see
// auto_ontology/infra/feature_flags.py), so the answer is unchanged.
export const GET = withPermission({ pii: ['read'] })(async (req) =>
	proxyToBackend(req),
);

// Turn PII detection on or off instance-wide (admin-only).
//
// Deliberately does NOT trigger an ingest. The flag is read at the start of
// each ingest's PII step, so it applies from the next one onward — flipping it
// is a change of policy, not a request to re-scan. Existing PII tags are left
// in place.
//
// The boolean validation and the upsert now happen in the container, which owns
// the flag, so the request forwards verbatim.
export const PUT = withPermission({ pii: ['manage'] })(async (req) =>
	proxyToBackend(req),
);
