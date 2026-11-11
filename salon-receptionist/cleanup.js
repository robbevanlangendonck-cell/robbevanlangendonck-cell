'use strict';

// `npm run cleanup`: verwijdert afspraken die langer dan 30 dagen geleden
// plaatsvonden (bewaartermijn uit data/salon.json).

const { createSalonTools } = require('./tools');

const tools = createSalonTools();
const { removed, remaining } = tools.cleanupOldAppointments();
console.log(
  `Opgeruimd: ${removed} afspraak/afspraken ouder dan ${tools.salon.retentionDays} dagen verwijderd, ${remaining} bewaard.`
);
