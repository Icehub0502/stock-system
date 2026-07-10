import os, re, shutil
root = os.getcwd()
for entry in os.listdir(root):
    full_path = os.path.join(root, entry)
    if not os.path.isfile(full_path):
        continue
    name, ext = os.path.splitext(entry)
    if ext.lower() not in {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'}:
        continue
    match = re.search(r'(toyota|honda|mazda|nissan|isuzu|ford|mitsubishi|mg|suzuki|chevrolet|subaru|bmw|volvo|benz|hyundai)', name.lower())
    if not match:
        continue
    brand = match.group(1).title()
    brand_map = {'Mg': 'MG', 'Bmw': 'BMW', 'Benz': 'Benz', 'Hyundai': 'Hyundai'}
    brand = brand_map.get(brand, brand)
    brand_dir = os.path.join(root, brand)
    os.makedirs(brand_dir, exist_ok=True)
    dst = os.path.join(brand_dir, entry)
    if os.path.exists(dst):
        base, ext2 = os.path.splitext(entry)
        counter = 1
        while os.path.exists(os.path.join(brand_dir, f'{base}_{counter}{ext2}')):
            counter += 1
        dst = os.path.join(brand_dir, f'{base}_{counter}{ext2}')
    shutil.move(full_path, dst)
    print(f'moved {entry} -> {brand}/{os.path.basename(dst)}')
