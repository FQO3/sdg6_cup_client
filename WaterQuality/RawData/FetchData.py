#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
国家地表水水质自动监测实时数据爬虫
数据来源: 中国环境监测总站 国家水质自动综合监管平台
主页:     https://szzdjc.cnemc.cn:8070/GJZ/Business/Publish/Main.html
接口:     https://szzdjc.cnemc.cn:8070/GJZ/Ajax/Publish.ashx  (POST)

数据每 20 分钟自动刷新，建议爬取间隔 >= 4 小时。仅供学习研究使用。
"""

import re
import csv
import time
import argparse

import requests
import urllib3

# 站点使用旧版 TLS 证书，关闭证书校验并静默告警
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE = "https://szzdjc.cnemc.cn:8070/GJZ"
API = f"{BASE}/Ajax/Publish.ashx"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{BASE}/Business/Publish/RealDatas.html",
    "Origin": "https://szzdjc.cnemc.cn:8070",
}

# 水质类别数字 -> 名称
WQ_LEVEL = {
    "1": "Ⅰ类", "2": "Ⅱ类", "3": "Ⅲ类",
    "4": "Ⅳ类", "5": "Ⅴ类", "6": "劣Ⅵ类", "7": "未监测",
}

# 常见省份 ID（AreaID 为空表示全国）
PROVINCES = {
    "110000": "北京市", "120000": "天津市", "130000": "河北省", "140000": "山西省",
    "150000": "内蒙古自治区", "210000": "辽宁省", "220000": "吉林省", "230000": "黑龙江省",
    "310000": "上海市", "320000": "江苏省", "330000": "浙江省", "340000": "安徽省",
    "350000": "福建省", "360000": "江西省", "370000": "山东省", "410000": "河南省",
    "420000": "湖北省", "430000": "湖南省", "440000": "广东省", "450000": "广西壮族自治区",
    "460000": "海南省", "500000": "重庆市", "510000": "四川省", "520000": "贵州省",
    "530000": "云南省", "540000": "西藏自治区", "610000": "陕西省", "620000": "甘肃省",
    "630000": "青海省", "640000": "宁夏回族自治区", "650000": "新疆维吾尔自治区",
}

TAG_RE = re.compile(r"<[^>]+>")


def clean_cell(cell):
    """去掉单元格里的 HTML 标签，优先取 title 属性中的真实数值。"""
    if cell is None:
        return ""
    cell = str(cell)
    # span 的 title 属性通常保存原始未截断的数值
    m = re.search(r'title="([^"]*)"', cell)
    if m and m.group(1).strip():
        return m.group(1).strip()
    text = TAG_RE.sub("", cell).replace("&nbsp;", " ").strip()
    return text


def build_session():
    s = requests.Session()
    s.headers.update(HEADERS)
    s.verify = False
    return s


def fetch_page(session, area_id="", river_id="", mn_name="",
               page_index=1, page_size=60, timeout=30):
    """请求单页数据，返回解析后的 JSON dict。"""
    data = {
        "action": "getRealDatas",
        "AreaID": area_id,
        "RiverID": river_id,
        "MNName": mn_name,
        "PageIndex": page_index,
        "PageSize": page_size,
    }
    resp = session.post(API, data=data, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def parse_rows(payload):
    """把接口返回的 thead / tbody 转成 list[dict]。"""
    thead = [clean_cell(h) for h in payload.get("thead", [])]
    rows = []
    for tr in payload.get("tbody", []):
        cells = [clean_cell(c) for c in tr]
        row = dict(zip(thead, cells))
        # 补充水质类别中文名（列名一般为“水质类别”）
        for key in list(row.keys()):
            if "水质类别" in key and row[key] in WQ_LEVEL:
                row[key] = WQ_LEVEL[row[key]]
        rows.append(row)
    return thead, rows


def crawl(area_id="", river_id="", mn_name="", page_size=60,
          max_pages=None, delay=1.0):
    """
    翻页爬取全部数据。
    area_id / river_id 为空时爬取全国。
    返回 (表头列表, 数据行列表)。
    """
    session = build_session()
    first = fetch_page(session, area_id, river_id, mn_name, 1, page_size)
    total_pages = int(first.get("total", 1) or 1)
    if max_pages:
        total_pages = min(total_pages, max_pages)

    thead, rows = parse_rows(first)
    print(f"共 {total_pages} 页, 记录约 {first.get('records', '?')} 条")
    print(f"  第 1/{total_pages} 页 -> {len(rows)} 行")

    for p in range(2, total_pages + 1):
        time.sleep(delay)
        try:
            payload = fetch_page(session, area_id, river_id, mn_name, p, page_size)
            _, page_rows = parse_rows(payload)
            rows.extend(page_rows)
            print(f"  第 {p}/{total_pages} 页 -> {len(page_rows)} 行")
        except Exception as e:  # noqa: BLE001
            print(f"  第 {p} 页失败: {e}")
    return thead, rows


def save_csv(thead, rows, path):
    if not rows:
        print("无数据可保存")
        return
    fieldnames = thead if thead else list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"已保存 {len(rows)} 行 -> {path}")


def main():
    ap = argparse.ArgumentParser(description="国家地表水水质实时数据爬虫")
    ap.add_argument("--area", default="", help="省份ID，如 330000=浙江；留空=全国")
    ap.add_argument("--river", default="", help="流域ID，留空=全部")
    ap.add_argument("--name", default="", help="断面名称关键字搜索")
    ap.add_argument("--page-size", type=int, default=60, help="每页条数")
    ap.add_argument("--max-pages", type=int, default=None, help="最多爬取页数")
    ap.add_argument("--delay", type=float, default=1.0, help="翻页间隔秒数")
    ap.add_argument("-o", "--output", default="water_quality.csv", help="输出CSV路径")
    args = ap.parse_args()

    thead, rows = crawl(
        area_id=args.area,
        river_id=args.river,
        mn_name=args.name,
        page_size=args.page_size,
        max_pages=args.max_pages,
        delay=args.delay,
    )
    save_csv(thead, rows, args.output)


if __name__ == "__main__":
    main()
