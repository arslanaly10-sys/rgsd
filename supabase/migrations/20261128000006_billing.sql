-- Day 5: invoice QR (ZATCA TLV) and stored UBL XML path.
alter table invoices add column qr_tlv text, add column xml_path text, add column notes text;
