from audit_common import build_all, output_json

if __name__ == "__main__":
    output_json("m3_match.json", build_all()["m3_match.json"])
