-- Rodar direto no Neon (producao). Read-only, sem risco.
SELECT r.full_name, m.reference_month, m.amount, m.status, m.transaction_id, m.paid_at
FROM mensalidades m
JOIN transactions t ON t.id = 'dc56c86f-d0e2-48e9-b97f-dc51211f772d'
JOIN residents r ON r.id = t.resident_id
WHERE m.resident_id = t.resident_id AND m.association_id = t.association_id
ORDER BY m.reference_month;
