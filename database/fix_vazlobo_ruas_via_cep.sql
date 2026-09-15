-- Rodar direto no Neon (producao). Transacao aberta, nao commita sozinho.
-- Preenche address_street/neighborhood/city/state pra moradores do Vaz
-- Lobo que tinham CEP mas rua vazia -- rua resolvida via ViaCEP (dado
-- real, nao inventado). 7 CEPs invalidos/inexistentes ficam de fora
-- (Maria Do Carmo Queiros - 21360960, Luís Barman - 21361115,
-- Rebeca Santos - 21560460, Wendrew Raphaell - 21560490,
-- Mariana Da Silva - 21630480, Drika Santos - 21960470,
-- Vínicius - 22361190) -- esses precisam de CEP corrigido antes.

BEGIN;

CREATE TEMP TABLE _cep_map (cep text PRIMARY KEY, rua text, bairro text, cidade text, uf text);
INSERT INTO _cep_map (cep, rua, bairro, cidade, uf) VALUES
    ('21360460', 'Rua Ramiro Monteiro', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21360470', 'Travessa Lópes Neto', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21360480', 'Rua Leri', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21360490', 'Rua Thevet', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361090', 'Rua Manuel Machado', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361100', 'Rua Almeida Braga', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361110', 'Rua Morse', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361120', 'Rua Aracua', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361150', 'Rua Macunaíma', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361160', 'Rua Teixeira da Costa', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361170', 'Travessa Luís Machado', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361190', 'Rua do Terço', 'Vaz Lobo', 'Rio de Janeiro', 'RJ'),
    ('21361600', 'Rua Várzea', 'Irajá', 'Rio de Janeiro', 'RJ');

-- preview
SELECT r.id, r.full_name, r.address_cep, m.rua
FROM residents r
JOIN _cep_map m ON m.cep = regexp_replace(r.address_cep, '\D', '', 'g')
WHERE r.address_street IS NULL OR r.address_street = '';

-- aplica
UPDATE residents r
SET address_street = m.rua, address_neighborhood = m.bairro,
    address_city = m.cidade, address_state = m.uf, updated_at = now()
FROM _cep_map m
WHERE m.cep = regexp_replace(r.address_cep, '\D', '', 'g')
  AND (r.address_street IS NULL OR r.address_street = '');

-- conferencia final
SELECT r.full_name, r.address_cep, r.address_street, r.address_neighborhood, r.address_city
FROM residents r
JOIN _cep_map m ON m.cep = regexp_replace(r.address_cep, '\D', '', 'g')
ORDER BY r.address_cep, r.full_name;

DROP TABLE _cep_map;

-- Se bater: COMMIT;
-- Se algo parecer errado: ROLLBACK;
