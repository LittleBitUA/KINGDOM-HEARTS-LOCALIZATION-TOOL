#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pack_bbs.py — запакувати перекладений text_all.txt назад у .ctd (Birth by Sleep)."""
import os, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bbstext

DEF_TXT  = r'C:\Users\dmytryk\Desktop\DropDistanceHD\BBS\text_all.txt'
DEF_GAME = r'D:\SteamLibrary\steamapps\common\KINGDOM HEARTS -HD 1.5+2.5 ReMIX-\Image\dt'
DEF_OUT  = r'C:\Users\dmytryk\Desktop\DropDistanceHD\BBS\build'

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--txt', default=DEF_TXT)
    ap.add_argument('--game', default=DEF_GAME)
    ap.add_argument('--out', default=DEF_OUT)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    for p, what in ((a.txt, 'text_all.txt'), (a.game, 'тека гри Image\\dt')):
        if not os.path.exists(p):
            sys.exit('не знайдено %s: %s' % (what, p))
    ns = argparse.Namespace(txt=a.txt, root=a.game, out=a.out)
    sys.exit(bbstext.cmd_check(argparse.Namespace(txt=a.txt, root=a.game)) if a.dry
             else bbstext.cmd_pack(ns))
