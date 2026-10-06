from audit_common import build_all, output_json

if __name__ == "__main__":
    output_json("m1_source.json", build_all()["m1_source.json"])
