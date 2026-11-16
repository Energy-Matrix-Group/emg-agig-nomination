// The reference data the TBS B2B spec v3.0 fixes, from the design's SQL setup script (section 5, "Reference data").
// It seeds ref.Pipeline, ref.FileTemplate, ref.Designation and ref.ErrorCode once, when each table is empty, in
// the memory store and the SQL store alike. The shipper's contracts are the organisation's own, so they are not
// seeded: they are entered on the Reference data page.
//
// Two quirks are kept as the spec prints them, as the design did: the TNP inlet code 'TNP 01-01' (probably
// 'TNP I1-01'), and codes 100, 115 and 120, which appear in AGIG's response examples but not in Appendix J.
// Confirm both with AGIG. An unknown code in a response is still stored: nom.ResponseError has no foreign key.

export const PIPELINES = [
  ['DBNGP', 'Dampier to Bunbury Natural Gas Pipeline'],
  ['AOGP', 'Ashburton to Onslow Gas Pipeline'],
  ['FRGP', 'Fortescue River Gas Pipeline'],
  ['TNP', 'Tanami Natural Gas Pipeline'],
  ['WAWP', 'Wheatstone Ashburton West Pipeline'],
].map(([code, name]) => ({ code, name, isActive: true }));

// The SHNOM header, exactly as AGIG's template has it (Appendix B). Case and spacing matter: AGIG answers 501 otherwise.
export const FILE_TEMPLATE = [
  ['Gas Day', true],
  ['Shipper', true],
  ['Pipeline', true],
  ['Contract', true],
  ['Nom Type', true],
  ['Marketer', false],
  ['Service Type', false],
  ['Sub Service Type', false],
  ['Designation', true],
  ['Designation Location', false],
  ['Nominated Quantity (TJ)', true],
].map(([name, mandatory], index) => ({ order: index + 1, name, mandatory }));

// The spec v1 release. A point AGIG renames gets a ValidTo and a new row, so old nominations still read right.
export const DESIGNATIONS_VALID_FROM = '2025-08-01';

const RAW_DESIGNATIONS = [
  // A.1 Inlets - DBNGP
  ['DBNGP', 'I1-01', 'Inlet', 'KGP', 'Karratha Gas Plant', 'A.1'],
  ['DBNGP', 'I1-05', 'Inlet', 'Pluto - Rec', 'Pluto Receipt', 'A.1'],
  ['DBNGP', 'I1-03', 'Inlet', 'MLV7 IC - Rec', 'MLV7 Receipt', 'A.1'],
  ['DBNGP', 'I1-04', 'Inlet', 'Devil Creek', 'Devil Creek Receipt', 'A.1'],
  ['DBNGP', 'I1-02', 'Inlet', 'Varanus Island', 'Varanus Island Receipt', 'A.1'],
  ['DBNGP', 'I2-01', 'Inlet', 'Gorgon', 'Gorgon Receipt', 'A.1'],
  ['DBNGP', 'I2-02', 'Inlet', 'Macedon', 'Macedon Receipt', 'A.1'],
  ['DBNGP', 'I3-03', 'Inlet', 'Wheatstone IC - Rec', 'Wheatstone Interconnect Receipt', 'A.1'],
  ['DBNGP', 'I8-01', 'Inlet', 'MSFR', 'Mondarra Storage Facility Receipt', 'A.1'],
  ['DBNGP', 'I8-02', 'Inlet', 'Waitsia', 'Waitsia Receipt', 'A.1'],
  // A.2 Outlets - DBNGP
  ['DBNGP', 'NGP-NM', 'Outlet', 'North Metro', 'North Metro Sub Network', 'A.2'],
  ['DBNGP', 'NGP-RO', 'Outlet', 'Rockingham SN', 'Rockingham Sub Network', 'A.2'],
  ['DBNGP', 'NGP-SM', 'Outlet', 'South Metro', 'South Metro Sub Network', 'A.2'],
  ['DBNGP', 'O10-01', 'Outlet', 'Burrup Fertilisers', null, 'A.2'],
  ['DBNGP', 'O12-01', 'Outlet', 'Robe River', null, 'A.2'],
  ['DBNGP', 'O12-03', 'Outlet', 'MLV7 IC - Del', 'MLV7 Interconnect Delivery Point', 'A.2'],
  ['DBNGP', 'O12-04', 'Outlet', 'Seven Mile Well', null, 'A.2'],
  ['DBNGP', 'O13-01', 'Outlet', 'Maitland', null, 'A.2'],
  ['DBNGP', 'O14-01', 'Outlet', 'Pluto - Del', 'Pluto Delivery Point', 'A.2'],
  ['DBNGP', 'O15-01', 'Outlet', 'Cape Preston - Del', 'Cape Preston Delivery Point', 'A.2'],
  ['DBNGP', 'O16-01', 'Outlet', 'MLVL7 Backflow - Del', null, 'A.2'],
  ['DBNGP', 'O21-01', 'Outlet', 'GGP IC', 'Goldfields Gas Pipeline (GGP) Interconnect Delivery', 'A.2'],
  ['DBNGP', 'O22-01', 'Outlet', 'FRGP IC - Del', 'Fortescue River Pipeline (FRGP) Interconnect Delivery', 'A.2'],
  ['DBNGP', 'O31-01', 'Outlet', 'Woodhouse Wells - Exmouth PS', 'Woodhouse Wells - Exmouth Power Station', 'A.2'],
  ['DBNGP', 'O33-01', 'Outlet', 'Wheatstone IC - Del', 'WAWP Interconnect (Delivery) 16"', 'A.2'],
  ['DBNGP', 'O34-01', 'Outlet', 'AOGP/WAWP IC - Del', 'Ashburton to Onslow Gas Pipeline (AOGP) Wheatstone Ashburton West Gas Pipeline (WAWP) Interconnect Delivery', 'A.2'],
  ['DBNGP', 'O51-02', 'Outlet', 'Brown Range', null, 'A.2'],
  ['DBNGP', 'O81-01', 'Outlet', 'Nangetty Rd', null, 'A.2'],
  ['DBNGP', 'O81-02', 'Outlet', 'Mungarra Power Station - MPS', 'Mungarra Power Station', 'A.2'],
  ['DBNGP', 'O82-02', 'Outlet', 'Cockburn Cement Pye Rd', null, 'A.2'],
  ['DBNGP', 'O83-01', 'Outlet', 'Eneabba', null, 'A.2'],
  ['DBNGP', 'O85-01', 'Outlet', 'Eradu Rd', null, 'A.2'],
  ['DBNGP', 'O86-01', 'Outlet', 'MSFD', 'Mondarra Storage Facility Delivery', 'A.2'],
  ['DBNGP', 'O87-01', 'Outlet', 'NGI', 'Northern Goldfields Interconnect', 'A.2'],
  ['DBNGP', 'OKW-01', 'Outlet', 'Alcoa Kwinana Station', null, 'A.2'],
  ['DBNGP', 'OKW-03', 'Outlet', 'Barter Rd', null, 'A.2'],
  ['DBNGP', 'OKW-04', 'Outlet', 'Cockburn Power Station incl NewGen', null, 'A.2'],
  ['DBNGP', 'OKW-04-NP', 'Outlet', 'NewGen Kwinana', null, 'A.2'],
  ['DBNGP', 'OKW-05', 'Outlet', 'HEGT', 'High Efficiency Gas Turbine', 'A.2'],
  ['DBNGP', 'OP10-01', 'Outlet', 'Neerabup PS', 'Neerabup Power Station', 'A.2'],
  ['DBNGP', 'OP2-01', 'Outlet', 'Pinjar PS', 'Pinjar Power Station', 'A.2'],
  ['DBNGP', 'OP3-01', 'Outlet', 'Ellenbrook', null, 'A.2'],
  ['DBNGP', 'OP4-01', 'Outlet', 'Harrow St', null, 'A.2'],
  ['DBNGP', 'OP5-01', 'Outlet', 'Caversham', null, 'A.2'],
  ['DBNGP', 'OP6-01', 'Outlet', 'Welshpool', null, 'A.2'],
  ['DBNGP', 'OP7-01', 'Outlet', 'Forrestdale', null, 'A.2'],
  ['DBNGP', 'OP8-01', 'Outlet', 'Russell Rd', null, 'A.2'],
  ['DBNGP', 'OP9-01', 'Outlet', 'Della Rd', null, 'A.2'],
  ['DBNGP', 'OPLPG-01', 'Outlet', 'WLPG', 'Wesfarmers Liquified Petroleum Gas', 'A.2'],
  ['DBNGP', 'OPLPG-02', 'Outlet', 'WLNG', 'Wesfarmers Liquified Natural Gas', 'A.2'],
  ['DBNGP', 'OPLPGOSO-01', 'Outlet', 'AGR', 'Australian Gold Reagents', 'A.2'],
  ['DBNGP', 'ORK-01', 'Outlet', 'BP Cogen', null, 'A.2'],
  ['DBNGP', 'ORK-02', 'Outlet', 'Mason Rd', null, 'A.2'],
  ['DBNGP', 'ORK-03', 'Outlet', 'Rockingham', null, 'A.2'],
  ['DBNGP', 'ORK-04', 'Outlet', 'KNR', 'Kwinana Nickel Refinery', 'A.2'],
  ['DBNGP', 'ORK-05', 'Outlet', 'Thomas Rd', null, 'A.2'],
  ['DBNGP', 'ORK-06', 'Outlet', 'Burton Place', null, 'A.2'],
  ['DBNGP', 'OS1-01', 'Outlet', 'Pinjarra Town', null, 'A.2'],
  ['DBNGP', 'OS2-01', 'Outlet', 'Alcoa Pinjarra', 'Alcoa Pinjarra Station', 'A.2'],
  ['DBNGP', 'OS2-03', 'Outlet', 'Pinjarra Cogen', 'Pinjarra Cogen Facility', 'A.2'],
  ['DBNGP', 'OS3-01', 'Outlet', 'Alcoa Wagerup', 'Alcoa Wagerup Station', 'A.2'],
  ['DBNGP', 'OS3-01-NP', 'Outlet', 'Alcoa Wagerup Gas Turbine', null, 'A.2'],
  ['DBNGP', 'OS3-02', 'Outlet', 'Wagerup Cogen', null, 'A.2'],
  ['DBNGP', 'OS4-01', 'Outlet', 'Harvey', null, 'A.2'],
  ['DBNGP', 'OS4-02', 'Outlet', 'Worsley', null, 'A.2'],
  ['DBNGP', 'OS5-01', 'Outlet', 'Kemerton', null, 'A.2'],
  ['DBNGP', 'OS6-01', 'Outlet', 'Clifton Rd', null, 'A.2'],
  ['DBNGP', 'OS7-01', 'Outlet', 'SW Cogen', 'South West Cogen Station Total', 'A.2'],
  ['DBNGP', 'OS8-01', 'Outlet', 'Kemerton PS', 'Kemerton Power Station', 'A.2'],
  ['DBNGP', 'OS9-01', 'Outlet', 'Mandurah', 'Mandurah Gate Station', 'A.2'],
  ['DBNGP', 'OS10-01', 'Outlet', 'Wellesley MS', 'Wellesley Meter Station', 'A.2'],
  // A.3 / A.4 AOGP
  ['AOGP', 'AOGP I1-01', 'Inlet', 'AOGP IC - Rec', 'AOGP Receipt from DBNGP', 'A.3'],
  ['AOGP', 'AOGP O2-01', 'Outlet', 'AOGP MS', 'AOGP Meter Station', 'A.4'],
  // A.5 / A.6 FRGP
  ['FRGP', 'FRGP I1-01', 'Inlet', 'FRGP IC - Rec', 'O22-01 FRGP Inlet from DBNGP', 'A.5'],
  ['FRGP', 'FRGP O1-01', 'Outlet', 'Solomon MS - Turbine', null, 'A.6'],
  ['FRGP', 'FRGP O2-01', 'Outlet', 'Solomon MS - Recip', null, 'A.6'],
  // A.7 / A.8 TNP (inlet code printed as "TNP 01-01" in the spec: confirm with AGIG)
  ['TNP', 'TNP 01-01', 'Inlet', 'Amadeus IC - Rec', 'Amadeus IC - Rec', 'A.7'],
  ['TNP', 'TNP O1-01', 'Outlet', 'Granites Meter Station - GMS', 'Granites Meter Station', 'A.8'],
  ['TNP', 'TNP O2-01', 'Outlet', 'Dead Bullock Soak - DBS', null, 'A.8'],
  // A.9 / A.10 WAWP
  ['WAWP', 'WI-01', 'Inlet', 'WHS Gas Plant - Rec', 'Receipt point from Wheatstone gas plant', 'A.9'],
  ['WAWP', 'WI-02', 'Inlet', 'WI-02 TGS', 'Receipt point from Tubridgi Gas Storage', 'A.9'],
  ['WAWP', 'WO-01', 'Outlet', 'Ashburton Port MS', 'Delivery point to Ashburton Port Meter Station', 'A.10'],
];

export const DESIGNATIONS = RAW_DESIGNATIONS.map(([pipelineCode, code, direction, locationName, notes, specSection]) => ({
  pipelineCode, code, direction, locationName, notes, specSection, validFrom: DESIGNATIONS_VALID_FROM, validTo: null,
}));

// Appendix J.5: the transport nomination codes.
export const ERROR_CODES = [
  ['501', 'Invalid Header or Import File Format Changed'],
  ['502', 'Nomination past the cutoff time or gas day'],
  ['503', 'Decimal Point Error (greater than 3 decimal points)'],
  ['504', 'Invalid Inlet Designation'],
  ['505', 'Invalid Inlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)'],
  ['506', 'Invalid Outlet Designation'],
  ['507', 'Invalid Outlet Point (combination of Contract: Inlet Designation: Pipeline: Customer)'],
  ['508', 'Cannot Nominate beyond 90 days'],
  ['509', 'Range Exceeded'],
  ['510', 'Invalid Gas Day'],
  ['511', 'Invalid Nomination Type'],
  ['512', 'Invalid Contract'],
  ['513', 'Invalid Pipeline'],
  ['514', 'Invalid Producer'],
  ['515', 'Invalid Marketer'],
  ['516', 'Inlet nominated is less than the minimum inlet capacity'],
  ['517', 'Contract Priority Missing'],
  ['518', 'Inlet Nominated Greater than Limit for inlet point'],
  ['519', 'Invalid Service Type'],
  ['520', 'Invalid Sub Service Type'],
  ['521', 'Nominated quantity Greater than Outlet capacity for outlet point'],
  ['522', 'Total Outlet Nominated greater than contract capacity'],
  ['523', 'Nominations across outlets greater than the maximum capacity'],
  ['524', 'Nominations across outlets greater than the Inlet Nominations'],
  ['525', 'Cannot Nominate the Excess capacity until the maximum capacity been used by outlets'],
  ['526', 'The corresponding inlet nomination is either missing or below the minimum inlet capacity'],
  ['527', 'Missing nominations'],
  ['528', 'Nominated quantity Greater than Spot Won Quantity'],
].map(([code, message]) => ({ code, message }));
