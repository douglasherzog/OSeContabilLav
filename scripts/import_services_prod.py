import sqlite3

dst_path = r'C:\Users\Usuario\AppData\Roaming\osecontabillav\osecontabil.db'

services = [
    (1,  "Blazer (feminino/masculino) à seco passado",              40,  "peca"),
    (2,  "Calça social à seco",                                     20,  "peca"),
    (3,  "Calça social à água",                                     15,  "peca"),
    (4,  "Camisa lavada e passada",                                   8,  "peca"),
    (5,  "Camisa lavada sem passar e dobrada",                        6,  "peca"),
    (6,  "Camiseta gola polo lavada e passada",                       8,  "peca"),
    (7,  "Camiseta gola polo lavada sem passar",                      6,  "peca"),
    (8,  "Casaco apenas secar",                                      20,  "peca"),
    (9,  "Hidratação couro",                                         60,  "peca"),
    (10, "Jaqueta/Casaco à seco",                                    45,  "peca"),
    (11, "Jaqueta/Casaco à água",                                    35,  "peca"),
    (12, "Lavagem à seco de terno (casaco e calça)",                 60,  "peca"),
    (13, "Lavagem capa de sofá",                                     40,  "peca"),
    (14, "Lavagem cobertor de lã",                                   65,  "peca"),
    (15, "Lavagem de Edredom/Cobertas/Cobertores qualquer tamanho",  48,  "peca"),
    (16, "Lavagem de almofada (depende do tamanho)",                 15,  "peca"),
    (17, "Lavagem de batinas",                                       40,  "peca"),
    (18, "Lavagem de calça de motoqueiro",                           50,  "peca"),
    (19, "Lavagem de capa de almofada",                              10,  "peca"),
    (20, "Lavagem de carrinho de bebê",                              70,  "peca"),
    (21, "Lavagem de colchão casal",                                150,  "peca"),
    (22, "Lavagem de colchão solteiro",                             100,  "peca"),
    (23, "Lavagem de cortina com forro",                             40,  "peca"),
    (24, "Lavagem de cortinas sem forro",                            30,  "peca"),
    (25, "Lavagem de farda completa (Brigada Militar)",              35,  "peca"),
    (26, "Lavagem de fronha",                                         2,  "peca"),
    (27, "Lavagem de jaqueta de couro",                              60,  "peca"),
    (28, "Lavagem de jaqueta de motoqueiro",                         70,  "peca"),
    (29, "Lavagem de kimono",                                        45,  "peca"),
    (30, "Lavagem de mantas",                                        38,  "peca"),
    (31, "Lavagem de pala/poncho",                                   70,  "peca"),
    (32, "Lavagem de peças de tricô/lã (depende do tamanho)",        10,  "peca"),
    (33, "Lavagem de sapato",                                        25,  "peca"),
    (34, "Lavagem de sofas/poltronas (+ 20,00 por cada retrátil)",   50,  "lugar"),
    (35, "Lavagem de tapete",                                        18,  "m2"),
    (36, "Lavagem de tapete de lã/pelego",                           25,  "m2"),
    (37, "Lavagem de travesseiro",                                   25,  "peca"),
    (38, "Lavagem de tênis",                                         35,  "peca"),
    (39, "Lavagem de urso de pelúcia (depende do tamanho)",          35,  "peca"),
    (40, "Lavagem de vestido de festa com lantejoulas",             100,  "peca"),
    (41, "Lavagem de vestido de festa sem lantejoulas",              70,  "peca"),
    (42, "Lavagem de vestido de noiva",                             100,  "peca"),
    (43, "Lavagem estofamento automotivo apenas",                   250,  "peca"),
    (44, "Lavagem interna de carro completa (estofados, teto e portas)", 350, "peca"),
    (45, "Lavagem uniformes industriais",                            10,  "kg"),
    (46, "Lavagem vestido de prenda",                                45,  "peca"),
    (47, "Peça única",                                                5,  "peca"),
    (48, "Restauração couro",                                       150,  "peca"),
    (49, "Roupa lavada e passada",                                   13,  "kg"),
    (50, "Roupa lavada sem passar",                                  11,  "kg"),
    (51, "Roupas apenas passada",                                    10,  "kg"),
    (52, "Roupas apenas secar",                                      10,  "kg"),
    (53, "Sobretudo à seco (depende do tamanho)",                    55,  "peca"),
    (54, "Tingimento (somente no preto)",                            75,  "peca"),
    (55, "Lavagem de colchão bebê",                                  80,  "peca"),
    (56, "Deslocamento",                                              0,  "un"),
    (57, "Camisete",                                                  0,  "peca"),
    (58, "Calça Jeans",                                              10,  "peca"),
    (59, "Quepe/Chapéu militar",                                     25,  "peca"),
    (60, "Toalha de mesa",                                           10,  "peca"),
    (61, "Camiseta",                                                  5,  "peca"),
    (62, "Capa de colchão",                                          20,  "peca"),
    (63, "bermuda",                                                   8,  "peca"),
    (64, "Cueca",                                                     3,  "peca"),
    (65, "Gravata",                                                   4,  "peca"),
    (66, "Lençol",                                                   10,  "peca"),
    (67, "Fronha",                                                    4,  "peca"),
    (68, "Toalha de Banho",                                           8,  "peca"),
    (69, "Toalha de Rosto",                                           5,  "peca"),
]

dst = sqlite3.connect(dst_path)

imported = 0
skipped = 0
for (_, name, price, unit) in services:
    existing = dst.execute("SELECT id FROM services WHERE name=?", (name,)).fetchone()
    if existing:
        skipped += 1
        continue
    dst.execute(
        "INSERT INTO services (name, description, category, unit_price, unit, active, created_at) VALUES (?,?,?,?,?,1,datetime('now'))",
        (name, None, 'geral', price, unit)
    )
    imported += 1

dst.commit()
dst.close()

print(f"Importados: {imported} | Ignorados (já existiam): {skipped}")
