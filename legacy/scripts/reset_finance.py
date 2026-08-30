import os, sqlite3, shutil, datetime, sys

def find_db():
    appdata = os.environ.get('APPDATA') or os.path.expanduser('~')
    cand_new = os.path.join(appdata, 'OS e Contabil - Lav', 'osecontabil.db')
    cand_old = os.path.join(appdata, 'osecontabillav', 'osecontabil.db')
    for p in (cand_new, cand_old):
        if os.path.exists(p):
            return p
    return None

def backup_db(path):
    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    dest = os.path.join(os.path.dirname(path), f'backup_{ts}.db')
    shutil.copy2(path, dest)
    return dest

def reset_finance(path):
    con = sqlite3.connect(path)
    cur = con.cursor()
    def safe(sql):
        try:
            cur.execute(sql)
            con.commit()
        except Exception:
            pass
    # clear tables
    for t in ('cash_ledger','os_payments','os_items','service_orders','accounts_payable','accounts_receivable'):
        safe(f'DELETE FROM {t}')
    safe('VACUUM')
    con.close()

if __name__ == '__main__':
    db = find_db()
    if not db:
        print('ERRO: Nenhum banco encontrado em APPDATA.')
        sys.exit(1)
    bkp = backup_db(db)
    reset_finance(db)
    print('Reset concluido com sucesso.')
    print('DB:', db)
    print('Backup:', bkp)
