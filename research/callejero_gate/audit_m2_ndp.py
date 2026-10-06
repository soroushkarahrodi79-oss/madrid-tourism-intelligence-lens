from audit_common import build_all, output_json

if __name__ == "__main__":
    output_json("m2_ndp.json", build_all()["m2_ndp.json"])
