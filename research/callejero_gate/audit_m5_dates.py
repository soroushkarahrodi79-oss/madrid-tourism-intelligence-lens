from audit_common import build_all, output_json

if __name__ == "__main__":
    output_json("m5_dates.json", build_all()["m5_dates.json"])
